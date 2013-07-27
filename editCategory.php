<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
require_once("category.php");
require_once("Manual.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$categories = Category::find_all();

$errors = array();
$required_fields = array('id', 'editCategory_category_title', 'editCategory_category_description');


$manuals = Manual::find_all(); 



if(isset($_POST['categoryId'])){
	$categoryId = $_POST['categoryId'];     
	$category = Category::find_by_id($categoryId);
?>

<!-- Load existing values for examination -->
<!-- 
	Created a multidimensional js array. First index stores the id of the category. Second index is the array,
	with all manuals associated with the specific category.
-->
<script>
	var currentTitle = '<?=$category->category_title?>';
	var editCategory_existingTitles = Array();

<?php 
	foreach($manuals as $manual){
?>
	editCategory_existingTitles['<?=$manual->id?>'] = Array();
<?php
	}
?>

<?php 
	foreach($categories as $aCategory){
?>
	editCategory_existingTitles['<?=$aCategory->manual_id?>'].push('<?=$aCategory->category_title?>');
<?php
	}
?>
</script>

	<!-- <div id="registerErrorMessages"></div> -->
	<form action="editCategory.php" method="post" id="editCategoryForm">
	<legend class="formTitle">Edit Category:</legend>
	<input type="hidden" id="submit2" name="submit"/>
	<input type="hidden" id="id" name="id" value="<?=$category->id?>"/> 
	<label for="manuals">Manual:</label>
	<select id="editCategory_manuals" name="editCategory_manual_id">
<?php
		foreach($manuals as $manual){
			if($category->manual_id == $manual->id) {
?>
				<option value="<?=$manual->id?>" selected><?=$manual->description?></option>
<?php
			} else {
?>
				<option value="<?=$manual->id?>"><?=$manual->description?></option>
<?php
			}
		}
?>
	</select>
	<label for="editCategory_category_title">Title:</label>
	<input class="text" type="text" id="editCategory_category_title" name="editCategory_category_title" value="<?=$category->category_title?>"/> 
	<div style="color:red; font-size:12px;" class="validation"></div>
	<label for="editCategory_category_description">Description:</label>
	<input class="text" type="text" id="editCategory_category_description" name="editCategory_category_description" value="<?=$category->category_description?>"/> 
	<div style="color:red; font-size:12px;" class="validation"></div>
	<div class="row-fluid">

		<div class='span6'>
			<input id="editCategorySubmit" type="submit" name="submit" class="btn btn-primary"/>
			<script>

				$('#editCategoryForm #editCategory_manuals').change(function(){
					// console.log('hhhhh ' + uploadCategory_existingTitles.toString());
					var selectedManualId = $(this).val();
					var categoryTitle = $('#editCategoryForm #editCategory_category_title').val();
					var categoryDescription = $('#editCategoryForm #editCategory_category_description').val();
					// console.log(selectedManualId);
					// console.log(categoryTitle);
					// console.log(categoryDescription);

					if(categoryTitle.length == 0){
						console.log('title required');
						$('#editCategory_category_title').next('div[class="validation"]').text('A title is required.');
							} else if ((jQuery.inArray(categoryTitle, editCategory_existingTitles[selectedManualId]) >= 0) && (categoryTitle != editCategory_existingTitles[selectedManualId][(jQuery.inArray(currentTitle, editCategory_existingTitles[selectedManualId]))])) {
						$('#editCategory_category_title').next('div[class="validation"]').text('This title already exists for this manual.');
					} else {
						$('#editCategory_category_title').next('div[class="validation"]').text('');	
					}

					if(categoryDescription.length == 0){
						$('#editCategory_category_description').next('div[class="validation"]').text('A description is required.');
					} else {
						$('#editCategory_category_description').next('div[class="validation"]').text('');	
					}

					// $('#editCategory_category_title').val('');
					// $('#editCategory_category_title').next().text('');
					// $('#editCategory_category_description').val('');
					// $('#editCategory_category_description').next().text('');
				});

				$('#editCategoryForm input').blur(function(){
					var id = $(this).attr('id');
					var value = $(this).val();
					var selectedManualId = $('#editCategory_manuals').val();
					// console.log(id);
					// console.log(selectedManualId);
					// console.log(jQuery.inArray(value, editCategory_existingTitles[selectedManualId]));
					// console.log(currentTitle);
					// console.log(editCategory_existingTitles[selectedManualId][(jQuery.inArray(value, editCategory_existingTitles[selectedManualId]))]);
					switch(id){
						case 'editCategory_category_title' :
							if(value.length == 0){
								$(this).next('div[class="validation"]').text('A title is required.');
							} else if ((jQuery.inArray(value, editCategory_existingTitles[selectedManualId]) >= 0) && (currentTitle != editCategory_existingTitles[selectedManualId][(jQuery.inArray(value, editCategory_existingTitles[selectedManualId]))])) {
								// console.log('HERE');
								$(this).next('div[class="validation"]').text('This title already exists for this manual');
							} else {
								$(this).next('div[class="validation"]').text('');	
							}
							break;
						case 'editCategory_category_description' :
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
				$('#editCategorySubmit').unbind();
				$('#editCategorySubmit').click(function(e){
					e.preventDefault();
					e.stopPropagation();
			//		alert('18');

					var valid = '';
					var errorDisplay = '' ;
					var required = ' is required.';
					var title = $('form[id="editCategoryForm"] #editCategory_category_title').val();
					var description = $('form[id="editCategoryForm"] #editCategory_category_description').val();
					var selectedManualId = $('#editCategory_manuals').val();

					if(title == ''){
						valid += '<p> A title is required. </p>';
						$('form[id="editCategoryForm"] #editCategory_category_title').next().text('A title is required.');
					} else if ((jQuery.inArray(title, editCategory_existingTitles[selectedManualId]) >= 0) && (currentTitle != editCategory_existingTitles[selectedManualId][(jQuery.inArray(title, editCategory_existingTitles[selectedManualId]))])) {
						// console.log('HERE');
						valid += '<p> This title already exists for this manual. </p>';
						$('form[id="editCategoryForm"] #editCategory_category_title').next('div[class="validation"]').text('This title already exists for this manual.');
					} else {
						$('form[id="editCategoryForm"] #editCategory_category_title').next('div[class="validation"]').text('');
					}
					if(description == ''){
						valid += '<p> A description is required. </p>';
						$('form[id="editCategoryForm"] #editCategory_category_description').next('div[class="validation"]').text('A description is required.');
					} else {
						$('form[id="editCategoryForm"] #editCategory_category_description').next('div[class="validation"]').text('');	
					}

					if(valid.length > 0){
						$('div[class="alert alert-error"]').remove();
						$('div[class="alert alert-success"]').remove();
						errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
						$('#registerErrorMessages').append(errorDisplay);
						$('#registerErrorMessages').removeAttr('style');
						$('#registerErrorMessages').fadeOut(2000);
					} else {
						registrationFormData = $('form[id="editCategoryForm"]').serialize();
						// alert(registrationFormData);
						submitEditCategory(registrationFormData);
					}
				});
			</script>
		</div>
		<div class='span6'>
			<button id="cancelCategorySubmit" class='btn btn-primary' type='button'>Cancel</button>
			<script>
				$('#cancelCategorySubmit').click(function(e){
					$("#addEditCategoriesBlock").load('uploadCategory.php');
				});
			</script>
		</div>

	</form>	
<?php
} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){
		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$mid = mysql_real_escape_string(htmlspecialchars($_POST['editCategory_manual_id']));
		$ct = mysql_real_escape_string(htmlspecialchars($_POST['editCategory_category_title']));
		$cd = mysql_real_escape_string(htmlspecialchars($_POST['editCategory_category_description']));


		$newCategory = Category::newCategory($mid, $ct, $cd);
		$newCategory->id = $id;
		if($newCategory->save()){
			redirect_to("categoryListing.php");
		} else {
			die("Could not edit category. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>

<script>

	function submitEditCategory(formData){
		$.ajax({
			type:'POST',
			url: 'editCategory.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Speech Category modified!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#speechCategories").load("categoryALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Speech Category could not be modified.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="editCategoryForm"]')[0].reset();
			}
		})
	};
</script>