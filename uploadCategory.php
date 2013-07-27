<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
require_once("category.php");
require_once("Manual.php");
require_once("function.php");
// include_once("header.php");


if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$categories = Category::find_all();

if(!isset($_SESSION['user_id']))
	redirect_to('login.php');

$manuals = Manual::find_all(); 

$errors = array();
$required_fields = array('uploadCategory_manual_id', 'uploadCategory_category_title', 'uploadCategory_category_description');

if(isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($required_field)) || (empty($required_field) && is_numeric($_POST[$required_field]))){
			$errors[] = $required_field . " is a required field.";
		}
	}

	if(empty($errors)){	
		$mId = mysql_real_escape_string(htmlspecialchars($_POST['uploadCategory_manual_id']));
		$ct = mysql_real_escape_string(htmlspecialchars($_POST['uploadCategory_category_title']));
		$cd = mysql_real_escape_string(htmlspecialchars($_POST['uploadCategory_category_description']));
		$newCategory = Category::newCategory($mId, $ct, $cd);

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

<!-- Load existing values for examination -->
<!-- 
	Created a multidimensional js array. First index stores the id of the category. Second index is the array,
	with all manuals associated with the specific category.
-->
<script>

	var uploadCategory_existingTitles = Array();

<?php 
	foreach($manuals as $manual){
?>
	uploadCategory_existingTitles['<?=$manual->id?>'] = Array();
<?php
	}
?>

<?php 
	foreach($categories as $category){
?>
	uploadCategory_existingTitles['<?=$category->manual_id?>'].push('<?=$category->category_title?>');
<?php
	}
?>
</script>

<!-- <div id="registerErrorMessages"></div> -->
<form action="uploadCategory.php" method="post" id="categorySubmit">
	<fieldset>
		<legend class="formTitle">New Speech Category:</legend>
		<label for="manuals">Manual:</label>
		<select id="manuals" name="uploadCategory_manual_id">
			<?php
				foreach($manuals as $manual){
					echo "<option value=\"" . $manual->id . "\">" . $manual->description . "</option></br>";
				}
			?>
		</select></br>
			<label for="uploadCategory_category_title">Title:</label>
			<input class="text" id="uploadCategory_category_title" name="uploadCategory_category_title"/>
			<div style="color:red; font-size:12px;" class="validation"></div>
			<label for="uploadCategory_category_description">Description:</label>
			<input class="text" id="uploadCategory_category_description" name="uploadCategory_category_description" type="textarea"/>
			<div style="color:red; font-size:12px;" class="validation"></div>
			<input type="hidden" id="submit2" name="submit"/>
			<input id="categorySubmitButton" type="submit" name="submit"/>
	</fieldset>
</form>


<script>	

	$('#categorySubmit #manuals').change(function(){
		// console.log('hhhhh ' + uploadCategory_existingTitles.toString());
		var currentSelectedManual = $(this).val();
		var categoryTitle = $('#categorySubmit #uploadCategory_category_title').val();
		var categoryDescription = $('#categorySubmit #uploadCategory_category_description').val();
		// console.log(currentSelectedManual);
		// console.log(categoryTitle);
		// console.log(categoryDescription);

		if(categoryTitle.length == 0){
			console.log('title required');
			$('#uploadCategory_category_title').next('div[class="validation"]').text('A title is required.');
		} else if (jQuery.inArray(categoryTitle, uploadCategory_existingTitles[currentSelectedManual]) >= 0) {
			$('#uploadCategory_category_title').next('div[class="validation"]').text('This title already exists for this manual.');
		} else {
			$('#uploadCategory_category_title').next('div[class="validation"]').text('');	
		}

		if(categoryDescription.length == 0){
			$('#uploadCategory_category_description').next('div[class="validation"]').text('A description is required.');
		} else {
			$('#uploadCategory_category_description').next('div[class="validation"]').text('');	
		}

		// $('#uploadCategory_category_title').val('');
		// $('#uploadCategory_category_title').next().text('');
		// $('#uploadCategory_category_description').val('');
		// $('#uploadCategory_category_description').next().text('');
	});

	$('#categorySubmit input').blur(function(){
		var id = $(this).attr('id');
		var value = $(this).val();
		var currentSelectedManual = $('#categorySubmit #manuals').val();
		// console.log('blur id: ' + id);
		// console.log('blur value: ' + value);
		// console.log('blur array: ' + uploadCategory_existingTitles[currentSelectedManual]);
		switch(id){
			case 'uploadCategory_category_title' :
				if(value.length == 0){
					$(this).next('div[class="validation"]').text('A title is required.');
				} else if (jQuery.inArray(value, uploadCategory_existingTitles[currentSelectedManual]) >= 0) {
					$(this).next('div[class="validation"]').text('This title already exists for this manual.');
				} else {
					$(this).next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadCategory_category_description' :
				if(value.length == 0){
					$(this).next('div[class="validation"]').text('A description is required.');
				} else {
					$(this).next('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});

	$('#addEditCategoriesBlock').unbind();
	$('#addEditCategoriesBlock').on("click","#categorySubmitButton", function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('15');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var title = $('form[id="categorySubmit"] #uploadCategory_category_title').val();
		var description = $('form[id="categorySubmit"] #uploadCategory_category_description').val();
		var currentSelectedManual = $('#categorySubmit #manuals').val();

		if(title == ''){
			valid += '<p> A title is required. </p>';
			$('form[id="categorySubmit"] #uploadCategory_category_title').next('div[class="validation"]').text('A title is required.');
		} else if (jQuery.inArray(title, uploadCategory_existingTitles[currentSelectedManual]) >= 0) {
			valid += '<p> This title already exists for this manual. </p>';
			$('form[id="categorySubmit"] #uploadCategory_category_title').next('div[class="validation"]').text('This title already exists for this manual.');
		} else {
			$('form[id="categorySubmit"] #uploadCategory_category_title').next('div[class="validation"]').text('');	
		}	

		if(description == ''){
			valid += '<p> A description is required. </p>';
			$('form[id="categorySubmit"] #uploadCategory_category_description').next().text('A description is required.');
		} else {
			$('form[id="categorySubmit"] #uploadCategory_category_description').next('div[class="validation"]').text('');	
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$('#registerErrorMessages').append(errorDisplay);
			$('#registerErrorMessages').removeAttr('style');
			$('#registerErrorMessages').fadeOut(2000);
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
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Speech Category added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#categoryListingBlock").load("categoryListing.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Speech Category could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="editUserForm"]')[0].reset();
			}
		});
	};
</script>