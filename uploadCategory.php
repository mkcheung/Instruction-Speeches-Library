<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
require_once("category.php");
include_once("header.php");


if(isset($_POST['submit'])){

	$required_fields = array('category_title', 'category_description');
	$errors = array();

	foreach($required_fields as $required_field){
		if(!(isset($required_field)) || (empty($required_field) && is_numeric($_POST[$required_field]))){
			$errors[] = $required_field . " is a required field.";
		}
	}

	if(empty($errors)){	
		$ct = mysql_real_escape_string($_POST['category_title']);
		$cd = mysql_real_escape_string($_POST['category_description']);
		$newCategory = Category::newCategory($ct, $cd);

		if($newCategory->save()){
			redirect_to("settings.php");
		} else {
			die("Problem uploading category. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo "<p>$error</p></br>";
		}
	}
}

?>

<div id="registerErrorMessages"></div>
<div id="registration">
	<form action="uploadCategory.php" method="post" id="categorySubmit">
		<fieldset>
			<legend>New Speech Category:</legend>
			<p>
				<label for="category_title">Title:</label>
				<input class="text" id="category_title" name="category_title" type="text"/></br>
			</p>
			<p>
				<label for="category_description">Description:</label>
				<input class="text" id="category_description" name="category_description" type="textarea"/></br>
			</p>
			<p>
				<input type="hidden" id="submit2" name="submit"/>
				<input id="categorySubmitButton" type="submit" name="submit"/></br>
			</p>
		</fieldset>
	</form>
</div>
<?
include_once("footer.php");
?>

<script>
	$('#addEditCategoriesBlock').unbind();
	$('#addEditCategoriesBlock').on("click","#categorySubmitButton", function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('15');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var title = $('form[id="categorySubmit"] #category_title').val();
		var description = $('form[id="categorySubmit"] #category_description').val();

		if(title == ''){
			valid += '<p> A title is required. </p>';
		}	
		if(description == ''){
			valid += '<p> A description is required. </p>';
		}	

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
		} else {
			registrationFormData = $('form[id="categorySubmit"]').serialize();
			submitCategory(registrationFormData);
		}
	});

	function submitCategory(formData){
		$.ajax({
			type:'POST',
			url: 'uploadCategory.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Success!</div>');
				$("#settingsControls").load("categoryALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Ajax problems.</div>');
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="editUserForm"]')[0].reset();
			}
		});
	};
</script>