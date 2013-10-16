<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("function.php");
require_once("Manual.php");
require_once("Session.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

if(isset($_POST['submit'])){

	$description = mysql_real_escape_string(htmlspecialchars($_POST['uploadManual_description']));
	$theNewManual = Manual::newManual($description);

	if($theNewManual->save()){
		return true;
	} else {
		die("The manual could not be added. " . mysql_error());
	}
}	

$manuals = Manual::find_all();
?>

<!-- Load existing values for examination -->
<script>
	var existingManuals = Array();
<?php 
	foreach($manuals as $manual){
?>
	existingManuals.push('<?=$manual->description?>');
<?php
	}
?>
</script>

<div id="manualAdd">
	<form id="manualAddForm" action="uploadManual.php" method="post">
		<legend class="formTitle">New Manual:</legend>
		<fieldset>
			<label for="uploadManual_description">Description:</label>
			<input class="text" name="uploadManual_description" id="uploadManual_description"/></br>
			<div style="color:red; font-size:12px;" class="validation"></div>
			<input id="submit" type="hidden" name="submit"/></br>
			<input id="manualAddSubmit" type="submit" name="submit" class="btn btn-primary pull-right"/></br>
		</fieldset>
	</form>
</div>

<script>

	$('#manualAddForm input').blur(function(){
		var id = $(this).attr('id');
		var value = $(this).val();
		switch(id){
			case 'uploadManual_description' :
				if(value.length == 0){
					$(this).siblings('div[class="validation"]').text('A description is required.');
				} else if (jQuery.inArray(value, existingManuals) >= 0) {
					$(this).siblings('div[class="validation"]').text('This manual already exists.');
				} else {
					$(this).siblings('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});
	$('#addEditManualBlock').unbind();
	$('#addEditManualBlock').on('click', '#manualAddSubmit', function(e){
		e.preventDefault();
		e.stopPropagation();
		// alert('inside addManualBlock');

		var valid = '';
		var errorDisplay = '';
		var required = ' is required.';


		description = $('form[id="manualAddForm"] #uploadManual_description').val();

		if(description == ''){
			valid += '<p> A description is required. </p>';
			$('form[id="manualAddForm"] #uploadManual_description').siblings('div[class="validation"]').text('A description is required.');
		} else if (jQuery.inArray(description, existingManuals) >= 0) {
			valid += '<p> This manual already exists. </p>';
			$('form[id="manualAddForm"] #uploadManual_description').siblings('div[class="validation"]').text('This manual already exists.');
		} else {
			$('form[id="manualAddForm"] #uploadManual_description').siblings('div[class="validation"]').text('');
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
			$("#registerErrorMessages").removeAttr('style');
			$("#registerErrorMessages").fadeOut(2000);
		} else {
			manualAddFormData = $('form[id="manualAddForm"]').serialize();
			submitManualData(manualAddFormData);
		}
	});

	
	function submitManualData(formData){
		$.ajax({
			type:'POST',
			url: 'uploadManual.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Manual Added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#manualListingBlock").load("manualListing.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Manual could not be added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="manualAddForm"]')[0].reset();
			}
		});
	};
</script>